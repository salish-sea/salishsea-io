/**
 * Build the read path when the data changes (salish-t3g.6): subscribe to the
 * same `occurrences_changed` broadcast the browser does, and run a build shortly
 * after each burst of changes. Runs on the Fly machine beside Caddy and the
 * hourly schedule, which stays as the backstop for a broadcast this missed.
 *
 *   SUPABASE_URL=… SUPABASE_PUBLISHABLE_KEY=… node scripts/read-path/listen.ts <build command>
 *
 * The broadcast is public, so the publishable key every browser has is enough;
 * the database credential stays with the build. Public also means anyone can
 * send it, so it is only a hint about WHEN to build: the coalescer spaces builds
 * at least two minutes apart whatever arrives. Broadcasts sent while not
 * subscribed are gone, so every subscription counts as a change, the first one
 * included: the boot build's snapshot and this subscription are not the same
 * moment, and a reconnection has missed whatever happened while it was down.
 *
 * This only works while Supabase Realtime sends the broadcast. Once the database
 * moves (decision 056, step 4), the signal has to come from the new write path.
 */

import { createClient } from '@supabase/supabase-js';

import { BuildCoalescer, commandBuild } from './coalesce.ts';

export async function main(): Promise<void> {
    const command = process.argv.slice(2);
    const url = process.env['SUPABASE_URL'];
    const key = process.env['SUPABASE_PUBLISHABLE_KEY'];
    if (command.length === 0 || !url || !key) {
        console.error('usage: SUPABASE_URL=… SUPABASE_PUBLISHABLE_KEY=… listen.ts <build command…>');
        process.exit(2);
    }

    const coalescer = new BuildCoalescer(commandBuild(command));
    createClient(url, key)
        .channel('occurrences')
        .on('broadcast', {event: 'occurrences_changed'}, () => {
            console.log('read-path listener: occurrences changed');
            coalescer.changed();
        })
        .subscribe(status => {
            console.log(`read-path listener: ${status}`);
            if (status === 'SUBSCRIBED') coalescer.changed();
        });
}

if (import.meta.main) {
    await main();
}

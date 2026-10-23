// TRIAL ONLY: which capabilities safaridriver accepts for the iOS 27 simulator.
const driver = 'http://localhost:4444';
const udid = process.env['SIMULATOR_UDID'];
const sets: Record<string, unknown>[] = [
    {browserName: 'Safari', platformName: 'iOS', 'safari:useSimulator': true, 'safari:deviceUDID': udid},
    {browserName: 'Safari', platformName: 'iOS', 'safari:useSimulator': true},
    {platformName: 'iOS', 'safari:useSimulator': true},
    {platformName: 'iOS'},
    {browserName: 'Safari', platformName: 'iOS', 'safari:useSimulator': true, 'safari:deviceType': 'iPhone', 'safari:platformVersion': '27.0'},
];
for (const caps of sets) {
    const response = await fetch(`${driver}/session`, {method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({capabilities: {alwaysMatch: caps}})});
    const json = await response.json() as {value: {sessionId?: string, capabilities?: unknown, message?: string}};
    console.log(JSON.stringify(caps), '=>', response.ok ? `OK ${JSON.stringify(json.value.capabilities)}` : json.value.message);
    if (json.value.sessionId) await fetch(`${driver}/session/${json.value.sessionId}`, {method: 'DELETE'});
}

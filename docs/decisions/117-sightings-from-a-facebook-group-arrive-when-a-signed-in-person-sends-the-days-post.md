# 117 — Sightings from a Facebook group arrive when a signed-in person sends the day's post

**Status:** accepted · **Decided:** 2026-11-12, by Peter, after a prototype in Chrome and Firefox · **Work:** bd `salish-i1a.3` (the build-out is `salish-i1a.3.3` to `.9`; the prototype was `salish-i1a.3.1`) · **Relates to:** [007](007-community-uptake-strategy.md) (partnership-first; see below), [004](004-rights-and-licensing.md) and the [rights policy](../rights-policy.md), [105](105-the-build-and-the-browser-read-sighting-text-with-one-reader.md) (one reader of sighting text)

## Context

Orca Network's Community Group on Facebook is where much of the region's whale watching is reported first. Each day has one post, which the group's staff start with the day's first report and edit as reports come in. Observers report sightings as comments on that post, as in this one from 2026-11-12: *T137s currently westbound here 11:50* (Orca Behavior Institute). Staff copy sightings by hand into the Cascadia Web Map, which feeds Acartia, and so most of them reach SalishSea.io through Maplify, after a delay that depends on when someone has time to copy them.

Any way of reading the group sooner has to meet two conditions. It must not add copying work for the group's staff, whose time goes to running the group. And it must be quick, because some uses of a sighting need it minutes after it is posted, not hours.

What doesn't work:

- **Meta's API.** Meta removed the Groups API, its permissions and the ability of a group's admins to install apps on 2024-04-22 ([Graph API v19.0 changelog](https://developers.facebook.com/docs/graph-api/changelog/version19.0/)). No app can read a group, even with its owner's blessing. The Meta Content Library API covers public groups only, for vetted academic researchers working in a sandbox Meta controls, so it can't feed a public site.
- **Scraping.** A program that reads the group logs in as a member and reloads it every few minutes, which is how Facebook recognises a robot. Accounts get challenged or suspended, and when Facebook changes its markup a scraper returns nothing rather than failing, so a gap looks like a quiet day. Meta's terms forbid automated collection by a logged-in member.
- **Facebook's notifications.** They announce new posts, not comments on a post, and the sightings are comments. Facebook doesn't promise one for every post either.

## Decision

**A person who is reading the group, and is signed in to SalishSea.io with an approved account, sends the day's post with a bookmarklet.** One click sends the whole post as it is on their screen: its own text and every comment loaded on the page. SalishSea.io reads the sightings from it. Sending again later sends the post again, and SalishSea.io keeps what is new.

**The bookmarklet sends only the post, never the whole page.** The page around it carries the sender's chats, notifications and friends.

**The post travels in the address of a window the bookmarklet opens on salishsea.io.** The bookmarklet compresses the post's HTML with gzip, encodes it in base64url, and opens that window with the result after `#`. Browsers never send that part of an address to a server. The window reads it, clears it from the address, and sends the post to the write API with the sender's own session. The post of 2026-11-12, 395 KB of HTML, became 54 KB of text, well within the address limits of Chrome and Firefox. Two other ways failed in the prototype:

- *A form submitted from Facebook's page* arrived as a `GET` with no data: Facebook's page turned the form into a plain page load.
- *`postMessage` to the window* worked in Chrome. Firefox opened a bookmarklet's window with no link back to the Facebook tab (`window.opener` was null), so the message had nowhere to go.

Facebook's Content Security Policy doesn't allow a page to `fetch` from any other site, so the bookmarklet can't send the post straight to the write API.

**SalishSea.io reads the HTML, not the bookmarklet.** The code in a bookmark stays as it was when it was saved, while Facebook changes its markup often. Parsing on our side means a fix reaches everyone at once. The prototype found what the reading relies on today: each comment is an element with `role="article"` and an `aria-label` such as *Comment by … 2 hours ago* or *Reply by … to …'s comment*; each carries a `comment_id`, and a reply carries the `reply_comment_id` of the comment it answers; the post's own text is the text outside every comment. When the reading finds nothing, it fails loudly instead of reporting a quiet day.

**Comments are known by `comment_id`, and the post's lines by the time they first appeared.** The post is edited during the day, so each send compares its lines with the ones already seen.

**Desktop Chrome and Firefox only.** Bookmarklets don't run in Facebook's app and are awkward in mobile browsers. The prototype worked in Chrome, and in Firefox 159 with uBlock Origin.

## Relationship to 007

Decision 007 rejected bridging Facebook in both directions, because that leaves the real-time coordination of sightings inside Facebook. This decision reads from Facebook in one direction, and it does accept that the coordination stays there for now. It also delivers 007's first offer to Orca Network, the end of their staff's hand copying from Facebook into a report form, if their staff use it. 007's aim, coordination on SalishSea.io itself, is unchanged.

## Not decided

- **On what terms members' comments are republished, and whether observers' names appear** in the map and in the archive's `recordedBy`. To be written into the rights policy (bd `salish-i1a.3.9`); the terms themselves are agreed with Orca Network, outside the tracker.
- **Which accounts may send.** A short list, kept by us; who is on it follows from the conversation with Orca Network.
- **How a sighting that arrives from Facebook and again through Maplify is shown once** (bd `salish-i1a.3.7`).
- **How long the raw HTML is kept** so a fix to the reading can be run over recent sends. About a week was suggested; it holds members' names, so not longer than that use needs.

## Rejected

- **A browser extension.** It isn't bound by Facebook's CSP, can update itself, and could send new comments without a click. It costs more to build and install, and needs a store listing or a side-loaded package. Kept as the next step if the bookmarklet stops working.
- **A script running in a group admin's own browser that forwards posts by itself.** That is automated collection under Meta's terms, and it runs only while that browser is open.
- **Asking the group's staff to send sightings to us as well as to the Cascadia Web Map.** It doubles their copying.
- **Sending the whole page.** It carries the sender's private messages.

## Consequences

- The write API gains an endpoint for sent posts, open only to approved accounts (bd `salish-i1a.3.3`), and salishsea.io gains a page that offers the bookmarklet and the window it opens (bd `salish-i1a.3.8`).
- The build derives occurrences from the post's lines and comments with the same reader of sighting text as Maplify reports (105), under a new collection of kind `facebook_group` (bd `salish-i1a.3.6`).
- How soon a sighting arrives depends on how often someone sends the post. Each send picks up everything posted since the last one.
- When Facebook changes its markup, sightings from the group stop until the reading is fixed. The failure is loud, and old sends can be read again.

# salishsea-io
Salish Sea Data Explorer

Welcome! This is a new project, started in 2025, to gather sightings and information about whales in the Salish Sea. There is a ton of useful and interesting information about this ecosystem that would reach a greater audience if it were all in one place and cross-referenced. Over time, we hope the site can develop into a place for the people who live in the region to come connect, deepen their understanding of the ecology, and fight to protect it.

This codebase was started by Peter Abrahamsen. My goals for the codebase are to keep it relatively light, nimble, and maintainable, minimizing the number of abstractions or volatile third-party dependencies. Right now, I'm using:
- sqlite for storing and projecting data
- vite for building out assets
- express for serving assets and the API
- lit for templating and scoped styles

Most project planning currently happens on Zulip. You are welcome to join us there: https://orcasound.zulipchat.com/#narrow/channel/494032-salishsea-io

## Setup

Prerequisites:
- `nvm` (or install the version of node from `.nvmrc` yourself)
- `sqlite` (only needed for command line use)

Suggested: for better output from sqlite, make a file `~/.sqliterc` with these lines:
```
.headers on
.mode column
```

```
$ nvm install
$ nvm use
$ npm install
$ wget https://www.inaturalist.org/taxa/inaturalist-taxonomy.dwca.zip
$ unzip inaturalist-taxonomy.dwca.zip taxa.csv VernacularNames-english.csv
$ sqlite3 salish-sea.sqlite3 < setup.sql
```

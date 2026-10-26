#lang racket/base
;; The ingest graph as the project Stelis loads by this module's path (decision 092,
;; Stelis ADR 0020): `--project /app/stelis/salishsea-ingest.rkt`. The four source
;; ingests, with a state dir of their own, so they may run beside a build of the rest
;; (decisions 090 and 091). The graph itself is authored in salishsea.rkt, which
;; partitions one task list into the two projects.
(require "salishsea.rkt")
(provide (rename-out [salishsea-ingest-project project]))

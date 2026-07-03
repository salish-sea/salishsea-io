# Triage Labels

`triage` operates on this repo's **GitHub Issues** (the customer-facing inbox — see
[issue-tracker.md](issue-tracker.md)). This maps each canonical role to the actual
GitHub label; all five exist in the repo.

| Canonical role    | GitHub label      | Meaning                                   |
| ----------------- | ----------------- | ----------------------------------------- |
| `needs-triage`    | `needs-triage`    | Maintainer needs to evaluate this issue   |
| `needs-info`      | `question`        | Waiting on reporter for more information  |
| `ready-for-agent` | `ready-for-agent` | Fully specified, ready for an AFK agent   |
| `ready-for-human` | `ready-for-human` | Requires human implementation             |
| `wontfix`         | `wontfix`         | Will not be actioned                      |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the
corresponding GitHub label from this table. Edit the middle column if the vocabulary
changes.

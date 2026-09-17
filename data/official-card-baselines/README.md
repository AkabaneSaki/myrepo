# Official card baselines

This directory stores machine-readable snapshots extracted from official character-card releases.

Layout:

- Tracked repo data: `poem-of-destiny/<version>/manifest.json` and `worldbook-fingerprints.json`.
- Full parser output (`worldbook.json`, `regex.json`, `scripts.json`, `raw-card.json`, `baseline.json`) stays under `.cotel/local/official-card-baselines/...` and is not committed.
- `worldbook-fingerprints.json` is the compact runtime index used by Creative Workshop DLC Repair.

Repair does not treat every `[DLC]` worldbook entry as a Workshop install. For entries without Workshop metadata, the scanner compares only the stable identity fields that survive SillyTavern import/export normalization:

- name/comment
- content

Trigger keys, enabled/disabled state, ordering, position, strategy fields, and SillyTavern runtime UID are intentionally excluded. Players may edit those runtime settings without turning an official entry into a Workshop repair candidate.

If an entry has the same official baseline name but a different fingerprint, Repair fails closed: it reports the modified official entry and does not auto-delete it.

When a new official card version is added, keep its parsed machine files in `.cotel/local/official-card-baselines/poem-of-destiny/<version>-machine/`, copy the small `manifest.json` into the tracked version directory, then generate the tracked fingerprint index, for example:

`node data/official-card-baselines/generate-worldbook-fingerprints.mjs .cotel/local/official-card-baselines/poem-of-destiny/v4.3.3-machine data/official-card-baselines/poem-of-destiny/v4.3.3/worldbook-fingerprints.json`

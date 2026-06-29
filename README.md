# CERN Indico Briefing Agent

A small pipeline for discovering CERN Indico meetings, downloading their
attachments, extracting text from PDF and PPTX slides, and preparing source
material for a polished briefing.

## Setup

The project requires Python 3.10 or newer. After cloning the repository, create
an isolated environment and install its dependencies:

```sh
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements.txt
```

Sign in to the
[CERN Indico API tokens page](https://indico.cern.ch/user/tokens/) and select
**Create new token**. Give the token a descriptive name and grant
**Everything (only GET)** access, since this pipeline only reads meeting data
and attachments. Copy the token when it is displayed; Indico will not show it
again.

Store the bearer token outside the repository in `~/.indico.sh`:

```sh
export INDICO_TOKEN="indp_..."
```

The launcher sources this file automatically. Keep it readable only by your
account:

```sh
chmod 600 ~/.indico.sh
```

To process an event, run:

```sh
./scripts/run_indico_briefing.sh --event 1649690
```

For large events, filter first:

```sh
./scripts/run_indico_briefing.sh --event 1649690 --match EGammaStatus --limit 1
```

To process one known attachment URL:

```sh
./scripts/run_indico_briefing.sh \
  --attachment-url "https://indico.cern.ch/event/1649690/contributions/7000735/attachments/3300889/5905290/260623_ATLASWeek_EGammaStatus.pdf" \
  --title "ATLAS Week e/gamma status"
```

Outputs are written under `output/briefings/`.
Downloaded materials are cached under `output/cache/materials/` using Indico checksums when available, so repeated daily runs avoid fetching unchanged files.

## Public Result Approval Scrub

The first configured daily source is:

```sh
./scripts/run_indico_briefing.sh --source-config config/public_result_approval.json
```

For a smoke test with only a few materials:

```sh
./scripts/run_indico_briefing.sh --source-config config/public_result_approval.json --limit 3
```

To run an exact date instead of the rolling window:

```sh
./scripts/run_indico_briefing.sh \
  --source-config config/public_result_approval.json \
  --from-date 2026-06-19 \
  --to-date 2026-06-19
```

The generated `briefing.md` is an extraction artifact. A writing agent should
read it together with `docs/briefing_style.md` and turn the evidence into
polished narrative prose covering the main result, editorial-board reactions,
minutes, action items, and readiness.

## Daily Scheduling

On Linux or macOS, this cron entry runs the configured source every day at
07:00 and records operational output in `output/daily.log`:

```cron
0 7 * * * cd /path/to/cern-indico-briefing-agent && ./scripts/run_indico_briefing.sh --source-config config/public_result_approval.json >> output/daily.log 2>&1
```

The repository contains the retrieval and extraction pipeline. The current
Codex automation that performs the final editorial rewrite is local application
state, so it does not travel with Git. On another machine, schedule the command
above and point the writing agent of your choice at the newest run directory.

## Notes

- Protected Indico material requires `INDICO_TOKEN`.
- Public material works without a token.
- PDF extraction uses `pdfplumber`; PPTX extraction uses `python-pptx` when available.
- Old `.ppt` files are downloaded but not converted unless LibreOffice is installed.
- Tokens, virtual environments, downloaded slides, extracted text, and generated briefings are excluded from Git.

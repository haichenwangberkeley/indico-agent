# ⚡ Quick Start: Launch the Indico Portal

Run these commands to set up the portal and get it running:

1. **Request a CERN Indico API token**:
   Go to the [CERN Indico API tokens page](https://indico.cern.ch/user/tokens/). Select **Create new token**, name it, and grant **Everything (only GET)** access. Copy the token.

2. **Save the token** to `~/.indico.sh` in your terminal:
   ```sh
   echo 'export INDICO_TOKEN="your_token_here"' > ~/.indico.sh
   chmod 600 ~/.indico.sh
   ```

3. **Set up the environment and start the server**:
   ```sh
   python3 -m venv .venv
   . .venv/bin/activate
   pip install -r requirements.txt
   python3 server.py
   ```

4. **Open the portal** in your browser:
   **[http://localhost:5050](http://localhost:5050)** (or run `open http://localhost:5050` on macOS).

---

## 🛠️ Advanced Usage & CLI Tools

*(Development details below for advanced users)*

### CLI Briefing Generator
To run the automated text extraction and keyword matching for a specific event to generate a markdown briefing:
```sh
# Sourced automatically if ~/.indico.sh exists
./scripts/run_indico_briefing.sh --event 1649690
```
For large events, filter first:
```sh
./scripts/run_indico_briefing.sh --event 1649690 --match EGammaStatus --limit 1
```

### Daily Scheduling (Cron)
Run daily retrieval at 07:00 and log output:
```cron
0 7 * * * cd /path/to/indico-agent && ./scripts/run_indico_briefing.sh --source-config config/public_result_approval.json >> output/daily.log 2>&1
```

### Notes
- PDF extraction uses `pdfplumber`; PPTX uses `python-pptx`.
- Public Indico materials work without a token. Protected ones require `INDICO_TOKEN`.

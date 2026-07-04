# pi-crofai

CrofAI provider extension for [Pi](https://github.com/earendil-works/pi-coding-agent).

Dynamically discovers models and pricing from [crof.ai](https://crof.ai/), supports OpenAI-compatible chat completions and reasoning-effort-capable models.

## Install

```bash
pi install git:github.com/<user>/pi-crofai
```

## Uninstall

```bash
pi uninstall pi-crofai
```

## Configuration

1. Set `CROFAI_API_KEY` environment variable, or
2. Run `/login` in Pi and select **CrofAI** to enter your API key.

API keys look like `sk-crof-...`

## Usage

- Select a CrofAI model from the model picker (models are auto-discovered).
- `/refresh-crof` — force-refresh the model list from the API (bypasses 24h cache).

# mastracode-github-signals

GitHub pull request signals for [Mastra Code](https://github.com/mastra-ai/mastra), delivered as an
installable plugin instead of built-in wiring.

The plugin contributes a `GithubSignals` signal provider through the plugin system's
`signalProviders` field. Mastra Code owns the provider's lifecycle: it is registered with Mastra,
connected to the coding agent, started and polled, and it is stopped and replaced when this
repository is updated mid-session.

## Install

```
/plugins install github CodingButter/mastracode-github-signals
```

Requires [`gitcrawl`](https://github.com/mastra-ai/gitcrawl) on `PATH`, or one of
`MASTRACODE_GITCRAWL_BIN`, `GITCRAWL_BIN`, `MASTRACODE_GITCRAWL_COMMAND`, `GITCRAWL_COMMAND`.

Leave Mastra Code's built-in `experimentalGithubSignals` setting off: only one `github-signals`
provider may be live at a time.

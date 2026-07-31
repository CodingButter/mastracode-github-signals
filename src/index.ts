import { GithubSignals } from '@mastra/github-signals';
import { defineMastraCodePlugin, RequestContext } from 'mastracode/plugin';
import type { MastraCodePluginContext } from 'mastracode/plugin';

/**
 * The gitcrawl binary Mastra Code itself looks for, in the same order.
 */
function resolveGitcrawlCommand(): string | undefined {
  return (
    process.env.MASTRACODE_GITCRAWL_BIN ??
    process.env.GITCRAWL_BIN ??
    process.env.MASTRACODE_GITCRAWL_COMMAND ??
    process.env.GITCRAWL_COMMAND
  );
}

/**
 * Mastra Code stops a plugin's provider when this repository is updated, so shutdown has to clear
 * the per-thread polling timers this provider keeps in its own map. Released versions up to 0.2.2
 * inherit `stop()` from the base class, which only clears the base timer.
 */
class PluginGithubSignals extends GithubSignals {
  override stop(): void {
    super.stop();
    this.stopAllPolling();
  }
}

function createProvider(context: MastraCodePluginContext): GithubSignals {
  const provider = new PluginGithubSignals({
    cwd: context.cwd,
    gitcrawlCommand: resolveGitcrawlCommand(),
    /**
     * A woken notification runs as the session that owns the target resource, so it uses that
     * session's model, mode and state. The controller and the active session only exist after
     * plugins have loaded, so both are read through the context's lazy accessors at notification
     * time rather than captured at construction.
     */
    getNotificationStreamOptions: async ({ resourceId, threadId }) => {
      const controller = context.getController?.();
      if (!controller) throw new Error('Mastra Code controller is not available yet');
      const activeSession = context.getActiveSession?.();
      const session = (await controller.getSessionByResource(resourceId)) ?? activeSession;
      if (!session) throw new Error(`No session owns resource ${resourceId}`);

      // A long-running system must be able to drive work unattended, so a target session without
      // an explicit model selection falls back to a real model rather than failing the run.
      const modeId = session.mode.get();
      const defaultModeModelId = controller.listModes().find(mode => mode.id === modeId)?.defaultModelId;
      const modelId = session.model.get() || activeSession?.model.get() || defaultModeModelId || '';

      const requestContext = new RequestContext();
      requestContext.set('controller', {
        controllerId: controller.id,
        state: session.state.get(),
        getState: () => session.state.get(),
        setState: updates => session.state.set(updates),
        threadId,
        resourceId,
        session: {
          id: session.identity.getId(),
          ownerId: session.identity.getOwnerId(),
          modeId,
          modelId,
          state: {
            get: () => session.state.get(),
            set: updates => session.state.set(updates),
            update: updater => session.state.update(updater),
          },
        },
        workspace: controller.getWorkspace(),
        getSubagentModelId: params => session.subagents.model.get(params ?? {}),
      });

      return {
        memory: { thread: threadId, resource: resourceId },
        requestContext,
        maxSteps: 1000,
        savePerStep: false,
        requireToolApproval: (session.state.get() as Record<string, unknown>).yolo !== true,
        modelSettings: { temperature: 1 },
      };
    },
  });

  followActiveThread(provider, context);
  return provider;
}

/**
 * Polling is per thread, so the provider follows the session: stop every timer, then start one for
 * the current thread and sync it immediately.
 */
function followActiveThread(provider: GithubSignals, context: MastraCodePluginContext): void {
  const session = context.getActiveSession?.();
  if (!session) return;

  const startPollingForThread = async (threadId?: string | null) => {
    if (!threadId) return;
    provider.stopAllPolling();
    try {
      const threads = await session.thread.list({ allResources: true });
      const thread = threads.find((item: { id: string }) => item.id === threadId);
      await provider.startPollingForThread(
        { threadId, resourceId: thread?.resourceId ?? session.identity.getResourceId() },
        { pollImmediately: true },
      );
    } catch (error) {
      console.warn('Failed to start GitHub PR polling:', error);
    }
  };

  session.subscribe(event => {
    if (event.type === 'thread_changed') void startPollingForThread(event.threadId);
    else if (event.type === 'thread_created') void startPollingForThread(event.thread.id);
  });
  void startPollingForThread(session.thread.getId());
}

export default defineMastraCodePlugin({
  id: 'codingbutter.github-signals',
  name: 'GitHub Signals',
  description: 'Subscribe threads to GitHub pull requests and wake them when CI or review state changes.',
  signalProviders: context => [createProvider(context)],
});

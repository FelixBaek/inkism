import { loadHistories, flushHistories } from "./persistent-history";
import { snapshotLocations, type Location } from "./editor-location";
import { rpc } from "../api";
export interface Workspace {
  tabs: { id: string; title: string }[];
  active: string | null;
  locations?: Record<string, Location>;
}
export interface WorkspaceState {
  ids: string[];
  active: string | null;
  locations?: Record<string, Location>;
}
// One writer prevents a slow older request from overwriting newer tab changes.
let pending: WorkspaceState | null = null;
let running: Promise<void> | null = null;
export function queueWorkspace(state: WorkspaceState) {
  pending = { ...state, locations: snapshotLocations(state.ids) };
}
export function flushWorkspace(): Promise<void> {
  if (running) return running;
  running = (async () => {
    while (pending) {
      const next = pending;
      // Browser keepalive has a 64 KiB body budget. Native close awaits larger writes.
      const keepalive = new TextEncoder().encode(JSON.stringify(next)).byteLength < 60 * 1024;
      await rpc("workspace_set", next, { keepalive });
      if (pending === next) pending = null;
    }
  })().finally(() => {
    running = null;
  });
  return running;
}
export const loadWorkspace = async () => {
  const [workspace] = await Promise.all([rpc<Workspace>("workspace_get"), loadHistories()]);
  return workspace;
};

const auxiliaryFlush = new Set<() => Promise<void>>();
export function registerAuxiliaryFlush(flush: () => Promise<void>) {
  auxiliaryFlush.add(flush);
  return () => {
    auxiliaryFlush.delete(flush);
  };
}
let captureForClose: (() => void) | undefined;
export function registerWorkspaceCapture(capture: () => void) {
  captureForClose = capture;
  return () => {
    if (captureForClose === capture) captureForClose = undefined;
  };
}
export async function flushWorkspaceForClose() {
  for (const flush of auxiliaryFlush) await flush();
  await flushHistories();
  captureForClose?.();
  await flushWorkspace();
}

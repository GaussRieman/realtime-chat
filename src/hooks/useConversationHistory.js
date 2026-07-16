import { useCallback, useEffect, useRef, useState } from "react";

import {
  getConversation,
  getStorageHealth,
  listConversations,
  saveConversation,
  updateConversationAnalysis,
} from "../storage/api.js";

const INITIAL_SAVE_STATE = Object.freeze({
  status: "idle",
  conversationId: null,
  error: null,
});

function analysisFingerprint(result) {
  if (!result) return null;
  return JSON.stringify({
    summary: result.summary,
    concerns: result.concerns,
    generatedAt: result.generatedAt,
    summaryEdited: Boolean(result.summaryEdited),
    concernsEdited: Boolean(result.concernsEdited),
  });
}

export function useConversationHistory() {
  const [available, setAvailable] = useState(null);
  const [saveState, setSaveState] = useState(INITIAL_SAVE_STATE);
  const [listState, setListState] = useState({ status: "idle", items: [], error: null });
  const [detailState, setDetailState] = useState({ status: "idle", item: null, error: null });
  const pendingRef = useRef(new Map());
  const queuesRef = useRef(new Map());
  const latestConversationIdRef = useRef(null);
  const listRequestRef = useRef(0);
  const detailRequestRef = useRef(0);

  useEffect(() => {
    let active = true;
    getStorageHealth()
      .then((configured) => {
        if (active) setAvailable(configured);
      })
      .catch(() => {
        if (active) setAvailable(false);
      });
    return () => { active = false; };
  }, []);

  const enqueue = useCallback((conversationId, work) => {
    const previous = queuesRef.current.get(conversationId) ?? Promise.resolve();
    const next = previous.then(work, work);
    queuesRef.current.set(conversationId, next);
    void next.finally(() => {
      if (queuesRef.current.get(conversationId) === next) {
        queuesRef.current.delete(conversationId);
      }
    });
    return next;
  }, []);

  const persistPending = useCallback(async (conversationId) => {
    const pending = pendingRef.current.get(conversationId);
    if (!pending) return null;
    const updateCurrentSaveState = (nextState) => {
      if (latestConversationIdRef.current === conversationId) {
        setSaveState(nextState);
      }
    };
    updateCurrentSaveState({ status: "saving", conversationId, error: null });

    try {
      if (!pending.baseSaved) {
        await saveConversation(pending.snapshot);
        pending.baseSaved = true;
      }

      const fingerprint = analysisFingerprint(pending.analysis);
      if (fingerprint && fingerprint !== pending.savedAnalysisFingerprint) {
        try {
          const saved = await updateConversationAnalysis(
            conversationId,
            pending.analysis,
            pending.analysisVersion,
          );
          pending.analysisVersion = saved.analysisVersion;
          pending.savedAnalysisFingerprint = fingerprint;
        } catch (error) {
          if (error?.code !== "ANALYSIS_VERSION_CONFLICT") throw error;

          const current = await getConversation(conversationId);
          pending.conflictDetail = current;
          if (analysisFingerprint(current.analysis) !== fingerprint) throw error;

          // The update succeeded but its response may have been lost. Matching the
          // complete stored value lets a manual retry remain idempotent and safe.
          pending.analysisVersion = current.analysisVersion;
          pending.savedAnalysisFingerprint = fingerprint;
          pending.conflictDetail = null;
        }
      }

      updateCurrentSaveState({ status: "saved", conversationId, error: null });
      return pending;
    } catch (error) {
      updateCurrentSaveState({ status: "error", conversationId, error });
      return null;
    }
  }, []);

  const saveSnapshot = useCallback((snapshot) => {
    if (!snapshot?.conversationId || available === false) return Promise.resolve(null);
    latestConversationIdRef.current = snapshot.conversationId;
    pendingRef.current.set(snapshot.conversationId, {
      snapshot,
      baseSaved: false,
      analysis: null,
      analysisVersion: 0,
      savedAnalysisFingerprint: null,
    });
    return enqueue(snapshot.conversationId, () => persistPending(snapshot.conversationId));
  }, [available, enqueue, persistPending]);

  const saveAnalysis = useCallback((snapshot, result) => {
    if (!snapshot?.conversationId || !result || available === false) return Promise.resolve(null);
    const existing = pendingRef.current.get(snapshot.conversationId) ?? {
      snapshot,
      baseSaved: false,
      analysis: null,
      analysisVersion: 0,
      savedAnalysisFingerprint: null,
    };
    existing.snapshot = snapshot;
    existing.analysis = result;
    pendingRef.current.set(snapshot.conversationId, existing);
    latestConversationIdRef.current = snapshot.conversationId;
    return enqueue(snapshot.conversationId, () => persistPending(snapshot.conversationId));
  }, [available, enqueue, persistPending]);

  const retryLastSave = useCallback(() => {
    const conversationId = latestConversationIdRef.current ?? saveState.conversationId;
    if (!conversationId) return Promise.resolve(null);
    return enqueue(conversationId, () => persistPending(conversationId));
  }, [enqueue, persistPending, saveState.conversationId]);

  const refreshList = useCallback(async () => {
    const requestId = listRequestRef.current + 1;
    listRequestRef.current = requestId;
    setListState((current) => ({ ...current, status: "loading", error: null }));
    try {
      const items = await listConversations();
      if (requestId !== listRequestRef.current) return [];
      setListState({ status: "ready", items, error: null });
      return items;
    } catch (error) {
      if (requestId === listRequestRef.current) {
        setListState((current) => ({ ...current, status: "error", error }));
      }
      return [];
    }
  }, []);

  const loadDetail = useCallback(async (conversationId) => {
    const requestId = detailRequestRef.current + 1;
    detailRequestRef.current = requestId;
    setDetailState({ status: "loading", item: null, error: null });
    try {
      const item = await getConversation(conversationId);
      if (requestId !== detailRequestRef.current) return null;
      setDetailState({ status: "ready", item, error: null });
      return item;
    } catch (error) {
      if (requestId === detailRequestRef.current) {
        setDetailState({ status: "error", item: null, error });
      }
      return null;
    }
  }, []);

  const clearDetail = useCallback(() => {
    detailRequestRef.current += 1;
    setDetailState({ status: "idle", item: null, error: null });
  }, []);

  return {
    available,
    saveState,
    listState,
    detailState,
    saveSnapshot,
    saveAnalysis,
    retryLastSave,
    refreshList,
    loadDetail,
    clearDetail,
  };
}

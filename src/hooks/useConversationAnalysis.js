import { useCallback, useEffect, useReducer, useRef } from "react";

import { requestConversationAnalysis } from "../analysis/api.js";
import { analysisReducer, INITIAL_ANALYSIS_STATE } from "../analysis/analysisState.js";
import { createAnalysisPayload } from "../analysis/normalize.js";

export function useConversationAnalysis() {
  const [state, dispatch] = useReducer(analysisReducer, INITIAL_ANALYSIS_STATE);
  const requestIdRef = useRef(0);
  const controllerRef = useRef(null);

  const generate = useCallback(async (snapshot) => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    controllerRef.current?.abort();

    const payload = createAnalysisPayload(snapshot);
    if (!payload) {
      dispatch({ type: "empty", snapshot, requestId });
      return null;
    }

    const controller = new AbortController();
    controllerRef.current = controller;
    dispatch({ type: "start", snapshot, requestId });

    try {
      const result = await requestConversationAnalysis(payload, { signal: controller.signal });
      if (requestId !== requestIdRef.current) return null;
      dispatch({ type: "success", result, requestId });
      return result;
    } catch (error) {
      if (controller.signal.aborted || requestId !== requestIdRef.current) return null;
      dispatch({
        type: "failure",
        requestId,
        error: {
          code: error.code ?? "ANALYSIS_REQUEST_FAILED",
          message: error.message ?? "暂时无法生成会话分析。",
          retryable: error.retryable !== false,
        },
      });
      return null;
    }
  }, []);

  const retry = useCallback(() => {
    if (!state.snapshot || state.error?.retryable === false) return Promise.resolve(null);
    return generate(state.snapshot);
  }, [generate, state.error?.retryable, state.snapshot]);

  const saveSummary = useCallback((summary) => {
    dispatch({ type: "save-summary", summary });
  }, []);

  const saveConcerns = useCallback((concerns) => {
    dispatch({ type: "save-concerns", concerns });
  }, []);

  useEffect(() => () => controllerRef.current?.abort(), []);

  return {
    ...state,
    generate,
    retry,
    saveSummary,
    saveConcerns,
  };
}

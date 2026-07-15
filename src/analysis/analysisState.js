export const INITIAL_ANALYSIS_STATE = Object.freeze({
  status: "idle",
  snapshot: null,
  result: null,
  error: null,
  requestId: 0,
});

export function analysisReducer(state, action) {
  switch (action.type) {
    case "empty":
      return {
        ...INITIAL_ANALYSIS_STATE,
        status: "empty",
        snapshot: action.snapshot,
        requestId: action.requestId,
      };
    case "start":
      return {
        status: "generating",
        snapshot: action.snapshot,
        result: null,
        error: null,
        requestId: action.requestId,
      };
    case "success":
      if (action.requestId !== state.requestId) return state;
      if (action.result.conversationId !== state.snapshot?.conversationId) return state;
      return {
        ...state,
        status: "ready",
        result: {
          ...action.result,
          summaryEdited: false,
          concernsEdited: false,
        },
        error: null,
      };
    case "failure":
      if (action.requestId !== state.requestId) return state;
      return {
        ...state,
        status: "error",
        error: action.error,
      };
    case "save-summary": {
      if (!state.result) return state;
      const summary = action.summary.trim();
      if (!summary) return state;
      return {
        ...state,
        result: { ...state.result, summary, summaryEdited: true },
      };
    }
    case "save-concerns": {
      if (!state.result || action.concerns.length !== state.result.concerns.length) return state;
      const concerns = state.result.concerns.map((concern, index) => {
        const text = action.concerns[index]?.trim();
        return text ? { ...concern, text } : concern;
      });
      return {
        ...state,
        result: { ...state.result, concerns, concernsEdited: true },
      };
    }
    default:
      return state;
  }
}

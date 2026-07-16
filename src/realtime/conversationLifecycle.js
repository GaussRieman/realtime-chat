export function mountConversationLifecycle(endingRef, releaseResources) {
  endingRef.current = false;

  return () => {
    endingRef.current = true;
    releaseResources();
  };
}

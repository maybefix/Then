import { createSubmissionProcessor, type SubmissionRequest, type SubmissionResponse } from "./submissionProcessor";

const process = createSubmissionProcessor();
self.addEventListener("message", (event: MessageEvent<SubmissionRequest>) => {
  let response: SubmissionResponse;
  try { response = { id: event.data.id, result: process(event.data) }; }
  catch (error) { response = { id: event.data.id, error: String(error) }; }
  self.postMessage(response);
});

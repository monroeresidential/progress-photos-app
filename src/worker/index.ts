import { createApp } from "./app";

export default createApp({
  fetch: (input, init) => fetch(input, init),
  cache: () => caches.default,
  now: () => Date.now(),
});

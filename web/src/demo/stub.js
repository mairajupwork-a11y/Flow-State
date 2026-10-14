// Production builds never run the in-browser backend; this keeps it out of the bundle.
export function demoFetch() {
  throw new Error('Demo backend is only available in demo builds.');
}

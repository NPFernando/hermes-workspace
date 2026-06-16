# Auto-Improvement Plan: Improve API error handling with structured error responses

## Summary of the change
Modify the server-entry.js to return consistent JSON error objects with error code, message, and details instead of plain text or HTML errors. This improves client-side error handling and provides a uniform API response format.

## Files to modify
- `server-entry.js` (located in the workspace root)

## Steps
1. Backup the original server-entry.js (optional but recommended).
2. Open server-entry.js and locate the error handling middleware or try/catch blocks.
3. Replace any plain text or HTML error responses with a JSON object of the form:
   {
     "error": {
       "code": "<ERROR_CODE>",
       "message": "<Human-readable message>",
       "details": "<Optional additional details>"
     }
   }
   Ensure the response Content-Type is set to application/json.
4. For existing routes that throw errors, ensure they throw an object with code and message, or create a helper function to format errors.
5. Test the changes by starting the server and making requests that trigger errors (e.g., invalid endpoints, missing parameters).
6. Verify that the response is valid JSON and contains the expected error structure.

## How to verify the change works
- Start the server: `cd /home/ubuntu/hermes-workspace && node server-entry.js` (or use pm2/dev script).
- Use curl to request a non-existent endpoint: `curl -v http://localhost:3000/invalid`
- Check that the response is JSON and contains an error object.
- Alternatively, run the existing test suite if it includes error case tests: `pnpm test` (if configured).
- Ensure no regressions in normal responses (they should still be JSON or as expected).
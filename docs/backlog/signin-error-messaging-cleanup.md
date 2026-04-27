# Sign-in error messaging cleanup

**Session:** signin-error-messaging-cleanup  
**Issue:** https://github.com/wso2/product-integrator/issues/1023  
**PR:** https://github.com/wso2/vscode-extensions/pull/2100  
**Branch:** `fix/sign-in-outage-error-message` (based on `release/bi-1.8.x`)

---

## Problem

When the WSO2/Choreo backend is down (504 Gateway Time-out), the BI Copilot sign-in flow shows either a raw HTML error dump in the logs or a generic "Sign in failed. Please check the logs for more details." toast — neither tells the user anything actionable.

## What was done

Replaced the generic toast with `"WSO2 Cloud is temporarily unavailable. Please try again in a few minutes."` for any unrecognised sign-in failure, in two places:

| File | Change |
|------|--------|
| `workspaces/wso2-platform/wso2-platform-extension/src/uri-handlers.ts` | Catch block for `/signin` URI handler — always shows friendly message, always logs raw error |
| `workspaces/wso2-platform/wso2-platform-extension/src/cmds/sign-in-with-code-cmd.ts` | Same for the auth-code command path |
| `workspaces/ballerina/ballerina-extension/src/utils/ai/auth.ts` | `exchangeStsToCopilotToken` — shows outage message when axios gets a 5xx/empty/HTML response |

Typed `ResponseError` codes (`NoOrgsAvailable`, `NoAccountAvailable`) still surface their own specific toasts as before.

## Why no pattern matching

We tried pattern-matching on the Go LS error string (HTML body, `status code: 5xx`, network error strings) but Anjana (xlight05) pointed out:
1. When Devant is down the LS may return an empty or generic message — not necessarily the HTML body.
2. There is no way to validate the patterns without actually taking Devant down.

Decision: don't classify — for any unrecognised error just always show the friendly message and log the raw error. Nothing to validate, works for all error shapes.

## Outstanding / open questions

- PR is awaiting review from Anjana.
- The root fix (better error propagation from the Go LS) is a separate change in the LS repo and is out of scope for this PR.
- `cloneOrOpenDirectory` in `uri-handlers.ts` has a pre-existing unused-variable warning — not related to this fix.

## Auth flow summary (for context when resuming)

```
User clicks "Login using WSO2 Integration Platform"
  └─ AIMachineEventType.LOGIN → openLogin() [aiMachine.ts]
       └─ initiateDevantAuth() → WICommandIds.SignIn
            └─ sign-in-cmd.ts → getDevantSignInUrl (LS RPC) → browser opens
                 └─ browser callback → vscode://wso2.wso2-platform/signin?code=...
                      └─ uri-handlers.ts /signin → signInDevantWithAuthCode (LS RPC)
                           └─ LS calls choreo-token-exchange → 504 HERE on outage
                 └─ on success: subscribeIsLoggedIn(true) fires in aiMachine.ts
                      └─ getPlatformStsToken() → exchangeStsToCopilotToken()
                           └─ POST /auth-api/v1.0/auth/token-exchange → Copilot token
                                └─ stored in VS Code secrets → Authenticated state
```

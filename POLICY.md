# Policy

## Default policy philosophy

### Automatically allowed
- read-only actions
- summarization
- internal ledger updates
- recommendations
- draft generation (internal only)

### Requires approval
- `send_email`
- `send_whatsapp`
- `send_dm`
- `confirm_booking`
- `change_setting`
- `external_write_api`
- `public_post`
- `spend_money`

### Blocked by default
- unknown destructive action types
- empty or malformed actions
- actions with missing source/summary

## Why conservative defaults

The action gate should start useful but strict.
Loosen later only when there is evidence it is safe.

## Future policy layers

- source-specific rules
- target-specific rules
- approval scopes
- confidence/risk scoring
- optional reviewer model

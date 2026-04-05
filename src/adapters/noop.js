export async function executeNoop({ action }) {
  return {
    ok: true,
    adapter: 'noop',
    simulated: true,
    actionId: action.id,
    message: 'No-op adapter executed successfully'
  };
}

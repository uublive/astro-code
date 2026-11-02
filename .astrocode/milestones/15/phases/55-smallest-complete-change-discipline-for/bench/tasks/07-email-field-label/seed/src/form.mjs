export function renderForm() {
  return [
    '<form method="post" action="/signup">',
    '  <label for="name">Name</label>',
    '  <input id="name" name="name" type="text" required>',
    '  <button type="submit">Sign up</button>',
    '</form>',
  ].join('\n')
}

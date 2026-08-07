/**
 * One labelled input, with its hint and its error wired to it.
 *
 * No directive: it holds no state, so it renders on the server for server pages
 * and gets pulled into the client graph by the forms that import it.
 */
export function Field({
  name,
  label,
  hint,
  error,
  textarea,
  required,
  placeholder,
  defaultValue,
}: {
  name: string;
  label: string;
  hint?: string;
  error?: string;
  textarea?: boolean;
  required?: boolean;
  placeholder?: string;
  defaultValue?: string;
}) {
  const describedBy = [hint ? `${name}-hint` : null, error ? `${name}-error` : null]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="field">
      <label className="label" htmlFor={name}>
        {label}
        {required ? <span className="faint"> · required</span> : null}
      </label>
      {textarea ? (
        <textarea
          className="textarea"
          id={name}
          name={name}
          placeholder={placeholder}
          defaultValue={defaultValue}
          aria-describedby={describedBy || undefined}
          aria-invalid={error ? true : undefined}
        />
      ) : (
        <input
          className="input"
          id={name}
          name={name}
          required={required}
          placeholder={placeholder}
          defaultValue={defaultValue}
          aria-describedby={describedBy || undefined}
          aria-invalid={error ? true : undefined}
        />
      )}
      {hint ? (
        <span className="hint" id={`${name}-hint`}>
          {hint}
        </span>
      ) : null}
      {error ? (
        <span className="hint delta--bad" id={`${name}-error`} role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}

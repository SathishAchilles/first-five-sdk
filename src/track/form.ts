import { formKey, isExcluded } from '../sanitize';

/** Records that a form was submitted; never reads field values (PRD §5.3). */
export function installForms(onSubmit: (formKey: string) => void): () => void {
  const handler = (ev: Event) => {
    try {
      const form = ev.target as HTMLFormElement | null;
      if (!form || form.tagName !== 'FORM' || isExcluded(form)) return;
      onSubmit(formKey(form));
    } catch {
      // never break the host page
    }
  };
  document.addEventListener('submit', handler, true);
  return () => document.removeEventListener('submit', handler, true);
}

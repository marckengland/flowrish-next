/**
 * Single source of truth for personalization tag definitions.
 *
 * Both the rich text editor (which offers autocomplete + insertion) and
 * the email service (which substitutes tag values at send time) read
 * from this module so they cannot drift apart. Adding a new tag here
 * makes it discoverable in the editor *and* substitutable on send in
 * one change.
 *
 * The {@link Lead}-shaped object passed to `replacePersonalizationTags`
 * intentionally only declares the fields the tags resolve from — every
 * caller can satisfy it without dragging in the full Prisma model.
 */

export interface PersonalizationLead {
  firstName: string
  lastName: string
  companyName: string | null
  title: string | null
}

/**
 * Resolves a tag against a lead. We pre-compute these once instead of
 * re-deriving FullName from firstName/lastName at every render.
 */
type TagResolver = (lead: PersonalizationLead) => string

interface PersonalizationTag {
  /** The literal token a user types or inserts, e.g. `{{FirstName}}`. */
  tag: string
  /** Human label rendered in toolbars and chip rows. */
  label: string
  /** One-line explanation surfaced as a tooltip / autocomplete hint. */
  description: string
  /** Sample value rendered in the editor's preview pane. */
  sample: string
  /** Function used at send time to substitute the lead's value. */
  resolve: TagResolver
}

export const PERSONALIZATION_TAGS: readonly PersonalizationTag[] = [
  {
    tag: '{{FirstName}}',
    label: 'First Name',
    description: "Lead's first name",
    sample: 'John',
    resolve: (lead) => lead.firstName ?? '',
  },
  {
    tag: '{{LastName}}',
    label: 'Last Name',
    description: "Lead's last name",
    sample: 'Smith',
    resolve: (lead) => lead.lastName ?? '',
  },
  {
    tag: '{{FullName}}',
    label: 'Full Name',
    description: "Lead's full name",
    sample: 'John Smith',
    resolve: (lead) =>
      [lead.firstName, lead.lastName].filter(Boolean).join(' '),
  },
  {
    tag: '{{CompanyName}}',
    label: 'Company Name',
    description: "Lead's company",
    sample: 'Acme Corp',
    resolve: (lead) => lead.companyName ?? '',
  },
  {
    tag: '{{Title}}',
    label: 'Title / Role',
    description: "Lead's job title",
    sample: 'VP of Sales',
    resolve: (lead) => lead.title ?? '',
  },
] as const

export type { PersonalizationTag }

/**
 * Replaces every supported personalization token in `text` with the
 * corresponding value from `lead`. Uses split/join rather than
 * `String.replaceAll` so values that happen to contain `$&` / `$1` etc.
 * are not interpreted as replacement patterns.
 */
export function replacePersonalizationTags(
  text: string,
  lead: PersonalizationLead,
): string {
  let result = text
  for (const tag of PERSONALIZATION_TAGS) {
    result = result.split(tag.tag).join(tag.resolve(lead))
  }
  return result
}

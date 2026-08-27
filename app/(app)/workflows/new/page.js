import { TEMPLATES } from '@/lib/workflows/templates';
import { describeDefinition } from '@/lib/workflows/describe';
import TemplatePicker from '@/components/workflows/TemplatePicker';

export const dynamic = 'force-dynamic';

export default function NewWorkflowPage() {
  // The steps are described on the server so the picker shows what each
  // template actually does, not a marketing summary of it. A merchant deciding
  // between two automations is deciding between two lists of steps.
  const templates = TEMPLATES.map((template) => ({
    id: template.id,
    name: template.name,
    summary: template.summary,
    detail: template.detail,
    steps: describeDefinition(template.definition),
  }));

  return (
    <>
      <h1 style={{ fontSize: 20, margin: 0 }}>New automation</h1>
      <p className="sp-card-sub mt-1">
        Pick a starting point. It is created as a draft, so you can see who it would reach before
        anything is sent.
      </p>

      <TemplatePicker templates={templates} />
    </>
  );
}

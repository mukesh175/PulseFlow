import { NextResponse } from 'next/server';
import { requireStore, withStore } from '@/lib/api';
import { createWorkflow, InvalidWorkflowError } from '@/lib/workflows/manage';
import { TEMPLATES, findTemplate } from '@/lib/workflows/templates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Create a workflow, always as a draft. */
export const POST = withStore(async (request) => {
  const store = await requireStore();
  const body = await request.json().catch(() => null);

  // A definition can come from a template or be supplied directly. The template
  // path exists because a merchant with nothing on screen cannot edit their way
  // to a first automation.
  const template = body?.templateId ? findTemplate(body.templateId) : null;
  const definition = template?.definition ?? body?.definition;

  if (!definition) {
    return NextResponse.json(
      { error: 'Provide either a known templateId or a definition.', templates: TEMPLATES.map((t) => t.id) },
      { status: 400 }
    );
  }

  const name = (body?.name || template?.name || 'Untitled automation').slice(0, 120);

  try {
    const workflow = await createWorkflow({
      shopId: store.id,
      name,
      definition,
      createdBy: template ? 'template' : 'manual',
    });
    return NextResponse.json({ id: workflow.id, status: workflow.status }, { status: 201 });
  } catch (error) {
    if (error instanceof InvalidWorkflowError) {
      return NextResponse.json({ error: error.message, errors: error.errors }, { status: 422 });
    }
    throw error;
  }
});

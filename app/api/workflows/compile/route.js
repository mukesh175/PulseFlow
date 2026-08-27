import { NextResponse } from 'next/server';
import { requireStore, withStore } from '@/lib/api';
import { compileWorkflow, CompileError, isCompilerConfigured } from '@/lib/ai/compile';
import { describeDefinition, describeTrigger } from '@/lib/workflows/describe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Compile a description into a definition — and nothing else.
 *
 * Deliberately does not save. The merchant reads what was written, in the same
 * plain language the rest of the app uses, and only then decides to keep it.
 * Compiling straight into a stored workflow would make the model's output a
 * fact about their store before they had seen it.
 */
export const POST = withStore(async (request) => {
  const store = await requireStore();

  if (!isCompilerConfigured()) {
    return NextResponse.json(
      { error: 'The automation writer is not configured on this deployment.' },
      { status: 503 }
    );
  }

  const body = await request.json().catch(() => null);

  try {
    const { definition, name, usage } = await compileWorkflow({
      description: body?.description,
      storeName: store.shopName,
    });

    return NextResponse.json({
      definition,
      name,
      trigger: describeTrigger(definition),
      steps: describeDefinition(definition),
      usage,
    });
  } catch (error) {
    if (error instanceof CompileError) {
      return NextResponse.json({ error: error.message, errors: error.errors }, { status: error.status });
    }
    throw error;
  }
});

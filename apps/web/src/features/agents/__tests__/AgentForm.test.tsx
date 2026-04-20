import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AgentForm } from '../AgentForm';

const noop = vi.fn().mockResolvedValue(undefined);

describe('AgentForm', () => {
  it('renders all required fields', () => {
    render(
      <AgentForm
        onSubmit={noop}
        isSubmitting={false}
        submitLabel="Create Agent"
      />,
    );

    expect(screen.getByLabelText(/^name$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/system prompt/i)).toBeInTheDocument();
    // Provider uses visual card selection — verify the 3 option buttons exist
    expect(screen.getByRole('button', { name: /default/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /openai/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /anthropic/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/^model$/i)).toBeInTheDocument();
  });

  it('does NOT render a buffer_size field', () => {
    render(
      <AgentForm
        onSubmit={noop}
        isSubmitting={false}
        submitLabel="Create Agent"
      />,
    );

    expect(screen.queryByLabelText(/buffer/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/buffer_size/i)).not.toBeInTheDocument();
  });

  it('shows validation errors for empty required fields', async () => {
    const user = userEvent.setup();
    render(
      <AgentForm
        onSubmit={noop}
        isSubmitting={false}
        submitLabel="Create Agent"
      />,
    );

    await user.click(screen.getByRole('button', { name: /create agent/i }));

    // Name and system_prompt are required — should show error messages
    const errors = await screen.findAllByText(/too small|required|expected string/i);
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(noop).not.toHaveBeenCalled();
  });

  it('renders with default values when editing', () => {
    render(
      <AgentForm
        defaultValues={{
          name: 'My Agent',
          system_prompt: 'You are helpful.',
          provider: 'openai',
          model: 'gpt-4o-mini',
        }}
        onSubmit={noop}
        isSubmitting={false}
        submitLabel="Save Changes"
      />,
    );

    expect(screen.getByLabelText(/name/i)).toHaveValue('My Agent');
    expect(screen.getByLabelText(/system prompt/i)).toHaveValue(
      'You are helpful.',
    );
    expect(screen.getByLabelText(/model/i)).toHaveValue('gpt-4o-mini');
    expect(
      screen.getByRole('button', { name: /save changes/i }),
    ).toBeInTheDocument();
  });

  it('disables submit button when isSubmitting is true', () => {
    render(
      <AgentForm
        onSubmit={noop}
        isSubmitting={true}
        submitLabel="Create Agent"
      />,
    );

    expect(screen.getByRole('button', { name: /saving/i })).toBeDisabled();
  });
});

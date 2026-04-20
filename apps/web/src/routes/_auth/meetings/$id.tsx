import { createFileRoute, Outlet } from '@tanstack/react-router';

export const Route = createFileRoute('/_auth/meetings/$id')({
  component: MeetingIdLayout,
});

function MeetingIdLayout() {
  return <Outlet />;
}

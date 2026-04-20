import { useEffect } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import {
  ArrowLeftIcon,
  FileTextIcon,
  Loader2Icon,
  MicIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { remarkPlugins, markdownComponents } from '@/components/ui/markdown';
import { TranscriptColumn } from '@/components/insights/TranscriptColumn';
import {
  useMeeting,
  useMeetingSummary,
  useTranscript,
} from '@/features/meetings/hooks';

export const Route = createFileRoute('/_auth/meetings/$id/summary')({
  component: SummaryPage,
});

function SummaryPage() {
  const { id } = Route.useParams();
  const { data: meeting } = useMeeting(id);
  const isSummarizing = meeting?.status === 'summarizing';
  const {
    data: summary,
    isLoading: summaryLoading,
    isError: summaryError,
  } = useMeetingSummary(id);
  const { data: transcript } = useTranscript(id);
  const queryClient = useQueryClient();

  // Poll the meeting status while summarizing. When the meeting transitions
  // to 'ended', refetch the summary query so it picks up the new data.
  useEffect(() => {
    if (!isSummarizing) return;
    const interval = setInterval(async () => {
      await queryClient.invalidateQueries({ queryKey: ['meetings', id] });
      await queryClient.invalidateQueries({
        queryKey: ['meetings', id, 'summary'],
      });
    }, 5_000);
    return () => clearInterval(interval);
  }, [isSummarizing, id, queryClient]);

  return (
    <div className="mx-auto max-w-5xl p-6 lg:p-8">
      {/* Back button */}
      <Link to="/meetings/$id" params={{ id }}>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-muted-foreground mb-6"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Back to meeting
        </Button>
      </Link>

      {/* Page header */}
      <div className="flex items-center gap-3 mb-8">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--neon-accent)]/10">
          <FileTextIcon className="h-5 w-5 text-[var(--neon-accent)]" />
        </div>
        <div>
          <h1 className="text-xl font-semibold">
            {meeting?.title ?? 'Meeting Summary'}
          </h1>
          <p className="text-xs text-muted-foreground">
            Post-meeting summary
          </p>
        </div>
      </div>

      {/* Loading state */}
      {summaryLoading && (
        <div className="flex flex-col items-center justify-center py-20" role="status" aria-label="Loading summary">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="mt-4 text-sm text-muted-foreground">
            Loading summary...
          </p>
        </div>
      )}

      {/* Not available / generating */}
      {!summaryLoading && (summaryError || !summary) && (
        <Card className="border-0 shadow-lg">
          <CardContent className="py-12 text-center space-y-4">
            {meeting?.status === 'summarizing' ? (
              <>
                <Loader2Icon className="h-8 w-8 animate-spin text-amber-500 mx-auto" />
                <h2 className="text-lg font-semibold">
                  Summary is being generated...
                </h2>
                <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                  The meeting has ended and the AI is generating a summary.
                  Please check back shortly.
                </p>
              </>
            ) : (
              <>
                <FileTextIcon className="h-8 w-8 text-muted-foreground mx-auto" />
                <h2 className="text-lg font-semibold">
                  No summary available
                </h2>
                <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                  A summary has not been generated for this meeting yet.
                </p>
              </>
            )}
            <Link to="/meetings/$id" params={{ id }}>
              <Button variant="outline" size="sm" className="gap-1.5 mt-2">
                <ArrowLeftIcon className="h-4 w-4" />
                Back to meeting
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}

      {/* Summary content */}
      {!summaryLoading && summary && (
        <div className="space-y-6">
          {/* Agenda findings */}
          {summary.agenda_findings &&
            Object.keys(summary.agenda_findings).length > 0 && (
              <div className="space-y-4">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Agenda Findings
                </h2>
                {Object.entries(summary.agenda_findings).map(
                  ([item, content]) => (
                    <Card key={item} className="border-0 shadow-sm">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-base capitalize">
                          {item}
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        {content ? (
                          <div className="text-sm space-y-2 text-foreground/90">
                            <ReactMarkdown
                              remarkPlugins={remarkPlugins}
                              components={markdownComponents}
                            >
                              {content}
                            </ReactMarkdown>
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground italic">
                            No discussion on this topic.
                          </p>
                        )}
                      </CardContent>
                    </Card>
                  ),
                )}
              </div>
            )}

          {/* Raw summary */}
          {summary.raw_summary && (
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Overall Summary</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-sm space-y-2 text-foreground/90">
                  <ReactMarkdown
                    remarkPlugins={remarkPlugins}
                    components={markdownComponents}
                  >
                    {summary.raw_summary}
                  </ReactMarkdown>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Full transcript */}
          {transcript && transcript.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-4">
                <MicIcon className="h-4 w-4 text-blue-500" />
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Full Transcript
                </h2>
                <span className="text-[10px] font-mono text-muted-foreground/60 ml-auto">
                  {transcript.length} messages
                </span>
              </div>
              <Card className="border-0 shadow-sm overflow-hidden">
                <div className="h-[500px]">
                  <TranscriptColumn messages={transcript} />
                </div>
              </Card>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

type EmailPreviewFrameProps = {
  readonly description: string;
  readonly html: string;
  readonly title: string;
};

export const EmailPreviewFrame = ({
  description,
  html,
  title,
}: EmailPreviewFrameProps) => (
  <div className="rounded-3xl bg-white/76 p-4 shadow-2xl shadow-navy-blue/12 ring-1 ring-navy-blue/8">
    <div className="mb-4 rounded-2xl bg-navy-blue px-5 py-4 text-white">
      <p className="font-semibold text-sm uppercase tracking-[0.18em]">
        Temporary email preview
      </p>
      <p className="mt-1 text-white/80 text-sm">{description}</p>
    </div>
    <iframe
      className="h-230 w-full rounded-2xl bg-white"
      sandbox=""
      srcDoc={html}
      title={title}
    />
  </div>
);

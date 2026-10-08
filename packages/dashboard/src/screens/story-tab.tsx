import { StoryDiagram, type DiagramBand, type DiagramBox, type DiagramLink } from "@/components/story-diagram";
import { Card } from "@/components/ui/card";
import { useStory } from "@/hooks/use-story";
import {
  TICKET_KINDS,
  type StoryLayer,
  type StoryText,
  type StoryView,
  type TicketKind,
} from "@/lib/types";
import { cn } from "@/lib/utils";

const KIND_LABELS: Record<TicketKind, string> = {
  feature: "Feature",
  bugfix: "Bug fix",
  performance: "Performance",
  ui: "UI",
  data: "Data / migration",
  chore: "Config / chore",
};

const SIZE_LAYERS = ["Client", "API", "Domain", "Data", "Tests"];
const FLOW_LAYERS = ["Client", "API", "Domain", "Data"];
const MAX_SUB_COLUMNS = 3;

const baseName = (path: string): string => (path.split("/").pop() ?? path).replace(/\.[^.]+$/, "");

const folderOf = (path: string): string => path.split("/").slice(-3, -1).join("/");

const SectionTitle = ({ children }: { children: string }) => (
  <h2 className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">{children}</h2>
);

const KindChips = ({ kind }: { kind: TicketKind | undefined }) => (
  <div className="flex flex-wrap justify-end gap-2">
    {TICKET_KINDS.map((candidate) => (
      <span
        key={candidate}
        className={cn(
          "rounded-lg border px-3 py-1 text-sm",
          candidate === kind ? "bg-primary text-primary-foreground border-primary font-semibold" : "text-muted-foreground",
        )}
      >
        {KIND_LABELS[candidate]}
      </span>
    ))}
  </div>
);

const flowOf = (view: StoryView): { boxes: DiagramBox[]; bands: DiagramBand[]; links: DiagramLink[] } => {
  const layers = view.layers.filter((layer) => FLOW_LAYERS.includes(layer.layer));
  return {
    bands: layers.map((layer, row) => ({ label: layer.layer, row })),
    boxes: layers.flatMap((layer, row) =>
      layer.files.map((file, col) => ({
        id: file.path,
        title: baseName(file.path),
        sub: `${folderOf(file.path)} · +${file.added} −${file.deleted}`,
        mode: file.isNew ? ("new" as const) : ("changed" as const),
        row,
        col,
      })),
    ),
    links: view.edges.map((edge) => ({ from: edge.from, to: edge.to, label: edge.label })),
  };
};

const tablesOf = (view: StoryView): { boxes: DiagramBox[]; bands: DiagramBand[]; links: DiagramLink[] } => {
  const changed = new Set(view.tables.map((table) => table.name));
  const linked = [...new Set(view.tables.flatMap((table) => table.references))].filter((name) => !changed.has(name));
  const changedBoxes = view.tables.map(
    (table, col): DiagramBox => ({
      id: table.name,
      title: table.name,
      sub: table.isNew
        ? `new table · ${table.columns.length} columns`
        : `+ ${table.columns.slice(0, MAX_SUB_COLUMNS).join(", ")}`,
      mode: table.isNew ? "new" : "changed",
      row: 0,
      col,
    }),
  );
  const linkedBoxes = linked.map(
    (name, col): DiagramBox => ({ id: name, title: name, sub: "no change", mode: "plain", row: 1, col }),
  );
  return {
    bands: [
      { label: "Changed tables", row: 0 },
      ...(linked.length > 0 ? [{ label: "Linked tables", row: 1 }] : []),
    ],
    boxes: [...changedBoxes, ...linkedBoxes],
    links: view.tables.flatMap((table) =>
      table.references.map((name) => ({
        from: table.name,
        to: name,
        label: "FK",
        dashed: !changed.has(name),
      })),
    ),
  };
};

const Picture = ({ title, parts }: { title: string; parts: ReturnType<typeof flowOf> }) => (
  <Card className="gap-3 py-4">
    <div className="px-4">
      <SectionTitle>{title}</SectionTitle>
    </div>
    {parts.boxes.length === 0 ? (
      <p className="text-muted-foreground px-4 py-10 text-center text-sm">No changed files were recorded yet.</p>
    ) : (
      <div className="px-2">
        <StoryDiagram {...parts} />
      </div>
    )}
    <div className="text-muted-foreground flex gap-4 px-4 text-xs">
      <span>Dashed box = new</span>
      <span>Blue box = changed</span>
    </div>
  </Card>
);

const BeforeAfter = ({ story }: { story: StoryText }) => (
  <Card className="gap-3 py-4">
    <div className="px-4">
      <SectionTitle>Before and after</SectionTitle>
    </div>
    <div className="grid gap-3 px-4 md:grid-cols-2">
      <div className="bg-muted rounded-lg p-4">
        <SectionTitle>Before</SectionTitle>
        <p className="mt-2 text-sm">{story.before}</p>
      </div>
      <div className="bg-blue-1 border-blue-2 rounded-lg border p-4">
        <SectionTitle>After</SectionTitle>
        <p className="mt-2 text-sm font-medium">{story.after}</p>
      </div>
    </div>
  </Card>
);

const MetricRow = ({ metric }: { metric: NonNullable<StoryText["metrics"]>[number] }) => {
  const top = Math.max(metric.before, metric.after, 1);
  const unit = metric.unit ?? "";
  return (
    <div className="grid gap-2">
      <div className="flex items-baseline gap-3">
        <span className="text-muted-foreground w-28 text-xs font-semibold tracking-wider uppercase">{metric.name}</span>
        <span className="font-mono text-2xl font-semibold">
          {metric.before}
          {unit}
        </span>
        <span className="text-muted-foreground">→</span>
        <span className="text-primary font-mono text-2xl font-semibold">
          {metric.after}
          {unit}
        </span>
      </div>
      <div className="grid gap-1 pl-[7.75rem]">
        <div className="bg-blue-2 h-3 rounded" style={{ width: `${(metric.before / top) * 100}%` }} />
        <div className="bg-primary h-3 rounded" style={{ width: `${Math.max(1, (metric.after / top) * 100)}%` }} />
      </div>
    </div>
  );
};

const Metrics = ({ story }: { story: StoryText }) => (
  <Card className="gap-5 py-4">
    <div className="px-4">
      <SectionTitle>Measured before and after</SectionTitle>
    </div>
    <div className="grid gap-5 px-4">
      {(story.metrics ?? []).map((metric) => (
        <MetricRow key={metric.name} metric={metric} />
      ))}
    </div>
  </Card>
);

const OneLinePicture = ({ story }: { story: StoryText | undefined }) => (
  <Card className="items-center justify-center gap-2 px-8 py-16 text-center">
    <SectionTitle>What changed</SectionTitle>
    <p className="max-w-2xl text-xl font-medium">{story?.line ?? "No story was written for this ticket."}</p>
  </Card>
);

const pictureFor = (view: StoryView) => {
  const { kind, story } = view;
  if (kind === "bugfix" && story?.before && story.after) return <BeforeAfter story={story} />;
  if (kind === "performance" && story?.metrics && story.metrics.length > 0) return <Metrics story={story} />;
  if (kind === "ui" || kind === "chore") return <OneLinePicture story={story} />;
  if (kind === "data" && view.tables.length > 0) {
    return <Picture title="Changed tables and their links" parts={tablesOf(view)} />;
  }
  return <Picture title="How a request flows · changed parts in blue" parts={flowOf(view)} />;
};

const LineCard = ({ story }: { story: StoryText | undefined }) => (
  <Card className="gap-2 py-4">
    <div className="px-4">
      <SectionTitle>In one line</SectionTitle>
    </div>
    <p className={cn("px-4 text-base", !story && "text-muted-foreground text-sm")}>
      {story?.line ?? "No story was written for this ticket."}
    </p>
  </Card>
);

const ExampleCard = ({ example }: { example: NonNullable<StoryText["example"]> }) => (
  <Card className="gap-3 py-4">
    <div className="px-4">
      <SectionTitle>Example</SectionTitle>
    </div>
    <div className="grid gap-2 px-4 sm:grid-cols-2">
      <div className="bg-muted min-w-0 rounded-lg p-3">
        <SectionTitle>Input</SectionTitle>
        <p className="mt-1 font-mono text-sm break-words">{example.input}</p>
      </div>
      <div className="bg-blue-1 min-w-0 rounded-lg p-3">
        <SectionTitle>Result</SectionTitle>
        <p className="mt-1 font-mono text-sm break-words">{example.result}</p>
      </div>
    </div>
  </Card>
);

const SizeRow = ({ name, layer, top }: { name: string; layer: StoryLayer | undefined; top: number }) => (
  <div className="grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-center gap-3 text-sm">
    <span>{name}</span>
    {layer ? (
      <>
        <div className="flex h-3.5 items-center gap-0.5">
          <div className="bg-primary h-full rounded" style={{ width: `${Math.max(2, (layer.added / top) * 100)}%` }} />
          <div className="bg-blue-2 h-full rounded" style={{ width: `${(layer.deleted / top) * 100}%` }} />
        </div>
        <span className="text-muted-foreground font-mono text-xs">
          +{layer.added} −{layer.deleted}
        </span>
      </>
    ) : (
      <span className="text-muted-foreground col-span-2 text-xs">no change</span>
    )}
  </div>
);

const SizeCard = ({ layers }: { layers: StoryLayer[] }) => {
  const top = Math.max(1, ...layers.map((layer) => layer.added + layer.deleted));
  return (
    <Card className="gap-3 py-4">
      <div className="px-4">
        <SectionTitle>Size of the change</SectionTitle>
      </div>
      <div className="grid gap-2 px-4">
        {SIZE_LAYERS.map((name) => (
          <SizeRow key={name} name={name} layer={layers.find((layer) => layer.layer === name)} top={top} />
        ))}
      </div>
    </Card>
  );
};

export const StoryTab = ({ ticket }: { ticket: string }) => {
  const view = useStory(ticket);
  if (!view) {
    return (
      <Card className="text-muted-foreground flex-1 items-center justify-center text-sm">
        {view === undefined ? "Loading story" : "The story is not available."}
      </Card>
    );
  }
  return (
    <div className="flex size-full min-h-0 flex-col gap-3">
      <KindChips kind={view.kind} />
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(320px,32%)] gap-3">
        <div className="grid min-h-0 content-start gap-3 overflow-y-auto">{pictureFor(view)}</div>
        <div className="grid min-h-0 content-start gap-3 overflow-y-auto">
          <LineCard story={view.story} />
          {view.story?.example ? <ExampleCard example={view.story.example} /> : null}
          <SizeCard layers={view.layers} />
        </div>
      </div>
    </div>
  );
};

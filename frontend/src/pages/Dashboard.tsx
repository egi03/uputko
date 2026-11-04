import { useQuery } from "@tanstack/react-query";

import { api } from "../api";
import { useTitle } from "../hooks/useTitle";
import { PartA } from "./dashboard/PartA";
import { PartB } from "./dashboard/PartB";
import { PartC } from "./dashboard/PartC";
import { SourceTimetable } from "./dashboard/SourceTimetable";

/** The parts of the page, as pills under the title: one tap to each. */
const INDEX = [
  { href: "#dostupnost", label: "Stariji i ordinacije" },
  { href: "#liste", label: "Liste čekanja" },
  { href: "#upiti", label: "Upiti" },
  { href: "#stanje", label: "Izvori" },
];

function PageNav() {
  return (
    <nav className="pnav" aria-label="Na ovoj stranici">
      <ul>
        {INDEX.map((it) => (
          <li key={it.href}>
            <a href={it.href}>{it.label}</a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/* ================================================================== the page */

export function DashboardPage() {
  useTitle("Za općine");
  const sources = useQuery({ queryKey: ["sources"], queryFn: api.sources, staleTime: 5 * 60_000 });
  const pzzSince = sources.data?.find((s) => s.source_key === "hzzo_pzz")?.source_updated_at ?? null;
  const listsAt = sources.data?.find((s) => s.source_key === "cezih_lists")?.last_success_at ?? null;
  return (
    <div className="dash">
      <header className="phead">
        <div className="phead__text">
          <h1>Za općine</h1>
          <p className="phead__lede">
            Gdje je više starijih, a&nbsp;manje ordinacija, gdje se najdulje čeka i&nbsp;što ljudi pitaju asistenta.
          </p>
          <PageNav />
        </div>
      </header>
      <PartA pzzSince={pzzSince} />
      <PartB listsAt={listsAt} />
      <PartC />
      <SourceTimetable />
    </div>
  );
}

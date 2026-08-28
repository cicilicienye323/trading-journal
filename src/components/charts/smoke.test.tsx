/**
 * Dependency smoke test — not a feature test.
 *
 * Recharts 2.x had real peer-dependency friction with React 19. This renders a
 * minimal chart so the incompatibility, if it comes back on an upgrade, fails
 * here with a clear message instead of blowing up the first time the equity
 * curve is wired into a page.
 *
 * `ResponsiveContainer` is deliberately not used: jsdom reports zero width, so
 * it renders nothing and the test would pass without proving anything.
 */
import { render, screen } from "@testing-library/react";
import { Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";
import { describe, expect, it } from "vitest";

const DATA = [
  { date: "2026-01-01", equity: 10000 },
  { date: "2026-01-02", equity: 10250 },
  { date: "2026-01-03", equity: 9900 },
];

describe("recharts + react 19", () => {
  it("renders a line chart without throwing", () => {
    const { container } = render(
      <LineChart width={400} height={200} data={DATA}>
        <XAxis dataKey="date" />
        <YAxis />
        <Tooltip />
        <Line type="monotone" dataKey="equity" stroke="#0ea5e9" dot={false} />
      </LineChart>,
    );

    // Recharts renders to SVG; a <path> for the line means the series drew.
    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.querySelector(".recharts-line")).not.toBeNull();
  });

  it("plots the axis ticks it was given", () => {
    render(
      <LineChart width={400} height={200} data={DATA}>
        <XAxis dataKey="date" />
        <YAxis />
        <Line dataKey="equity" />
      </LineChart>,
    );

    expect(screen.getByText("2026-01-01")).toBeInTheDocument();
  });
});

import { WidgetFrame } from "@/components/widget-frame";

export const metadata = { title: "Talk to us", robots: { index: false } };

/** The page inside the website widget's frame. Public: starting a call needs a voice pass that only an allowed site can obtain. */
export default function WidgetFramePage() {
  return <WidgetFrame />;
}

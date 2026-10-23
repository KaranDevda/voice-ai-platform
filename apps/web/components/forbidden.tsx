import { ShieldAlert } from "lucide-react";
import { Card } from "./ui/card";
import { EmptyState } from "./ui/page";

export const Forbidden = () => (
  <Card><EmptyState icon={ShieldAlert} title="You don't have access to this page" description="Ask an Org Admin if you need a different role." /></Card>
);

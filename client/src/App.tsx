import { WorkspacePageView } from "./features/workspace/components/WorkspacePageView";
import { useWorkspacePageController } from "./features/workspace/useWorkspacePageController";

export default function App() {
  return <WorkspacePageView controller={useWorkspacePageController()} />;
}

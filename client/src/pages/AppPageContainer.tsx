import { WorkspacePageView } from "../features/workspace/components/WorkspacePageView";
import { useWorkspacePageController } from "../features/workspace/useWorkspacePageController";

function App() {
  const controller = useWorkspacePageController();
  return <WorkspacePageView controller={controller} />;
}

export default App;

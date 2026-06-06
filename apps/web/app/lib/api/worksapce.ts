export interface Workspace{
    id: string;
    name: string
}

export async function getWorkspaces(): Promise<Workspace[]> {
    const response = await fetch("http://localhost:8080/workspaces", {
      credentials: "include",
    });
  
    if (!response.ok) {
      throw new Error("Failed to fetch workspaces");
    }
  
    return response.json();
  } 
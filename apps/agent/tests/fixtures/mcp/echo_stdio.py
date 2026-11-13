"""A local stdio MCP server for the mcp_admin tests: three tools, no network, no account.

    <venv python> -I echo_stdio.py

`echo` returns its text, `lookup` is read-only, `send_message` only pretends (it returns
"would send" and writes nothing anywhere). Decision 20: MCP servers in tests are local fakes.
"""

from mcp.server.mcpserver import MCPServer
from mcp.types import ToolAnnotations

app = MCPServer("fake-echo-stdio")


@app.tool(name="echo", description="Return the text it was given.")
def echo(text: str) -> str:
    return f"echo: {text}"


@app.tool(name="lookup", description="Look a word up (read-only).",
          annotations=ToolAnnotations(readOnlyHint=True))
def lookup(word: str) -> str:
    return f"{word}: a fake definition"


@app.tool(name="send_message", description="Pretend to send a message (sends nothing).")
def send_message(to: str, body: str) -> str:
    return f"would send to {to}"


if __name__ == "__main__":
    app.run("stdio")

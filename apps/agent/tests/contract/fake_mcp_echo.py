"""A local stdio MCP server for the phase 5 host tests: one tool, ``echo``, that returns its text.
Never touches the network or any account (decision 20: MCP servers in tests are local fakes).

    <venv python> -I fake_mcp_echo.py
"""

from mcp.server.mcpserver import MCPServer

app = MCPServer("fake-echo")


@app.tool(name="echo", description="Return the text it was given.")
def echo(text: str) -> str:
    return f"echo: {text}"


if __name__ == "__main__":
    app.run("stdio")

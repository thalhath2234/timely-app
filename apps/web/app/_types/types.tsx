
export type SidebarProps = {
  name: string;
  icon: string;
  href: string;
};

export const SIDEBAR_ITEMS = [
    {
      name: "Calendar",
      icon: "Calendar",
      href: "/calendar",
    },
    {
      name: "Tasks",
      icon: "ListTodo",
      href: "/tasks",
    },
    {
      name: "Report",
      icon: "Brain",
      href: "/report",
    },
  ];
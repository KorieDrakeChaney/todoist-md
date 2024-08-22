import { Plugin } from "obsidian";
import { createContext, useContext, useState, ReactNode } from "react";
import TodoistMarkdownPlugin from "src/main";

interface PluginState {
  plugin: TodoistMarkdownPlugin;
}

const PluginContext = createContext<PluginState | undefined>(undefined);

interface PluginProviderProps {
  children: ReactNode;
  plugin: TodoistMarkdownPlugin;
}

export const PluginProvider = ({ children, plugin }: PluginProviderProps) => {
  return (
    <PluginContext.Provider value={{ plugin }}>
      {children}
    </PluginContext.Provider>
  );
};

export const usePluginContext = () => {
  const context = useContext(PluginContext);
  if (context === undefined) {
    throw new Error("usePluginContext must be used within an PluginProvider");
  }
  return context;
};

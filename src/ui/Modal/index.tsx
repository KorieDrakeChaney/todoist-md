import { Modal } from "obsidian";
import { createRoot, Root } from "react-dom/client";
import TodoistMarkdownPlugin from "../../main";
import { ReactNode } from "react";
import { PluginProvider } from "../context";
import { TokenValidatorModal } from "./TokenValidatorModal";

type ModalType = "TokenValidatorModal";

class ReactModal extends Modal {
  private root: Root | undefined;
  private plugin: TodoistMarkdownPlugin;
  private modalType: ModalType;

  constructor(plugin: TodoistMarkdownPlugin, type: ModalType) {
    super(plugin.app);
    this.plugin = plugin;
    this.modalType = type;
  }

  onOpen() {
    this.root = createRoot(this.contentEl);
    this.root.render(
      <PluginProvider plugin={this.plugin}>
        {this.getModalContent()}
      </PluginProvider>
    );
  }

  onClose() {
    this.root?.unmount();
  }

  getModalContent(): ReactNode {
    switch (this.modalType) {
      case "TokenValidatorModal":
        return <TokenValidatorModal modal={this} />;
    }
  }
}

export const createReactModal = (
  plugin: TodoistMarkdownPlugin,
  modalType: ModalType
) => {
  return new ReactModal(plugin, modalType);
};

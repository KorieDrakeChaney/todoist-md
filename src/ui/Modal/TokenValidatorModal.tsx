import { useEffect, useState } from "react";
import { usePluginContext } from "../context";
import styles from "./TokenValidatorModal.module.css";
import { Button } from "../components";
import { Modal, Notice } from "obsidian";

interface TokenValidatorModalProps {
  modal: Modal;
}

export const TokenValidatorModal = ({ modal }: TokenValidatorModalProps) => {
  const { plugin } = usePluginContext();

  return (
    <div className={styles["token-modal"]}>
      <div>
        <h2>Sync with Todoist</h2>
        <p>
          You can follow{" "}
          <a
            href={
              "https://todoist.com/help/articles/find-your-api-token-Jpzx9IIlB"
            }
          >
            Todoist guide
          </a>{" "}
          on finding your API token.
        </p>
      </div>
      <TokenInput
        onConfirm={() => {
          modal.close();
        }}
      />
    </div>
  );
};

interface TokenInputProps {
  onConfirm: () => void;
}

const TokenInput = ({ onConfirm }: TokenInputProps) => {
  const { plugin } = usePluginContext();
  const [token, setToken] = useState("");

  useEffect(() => {
    setToken(plugin.settings.token || "");
  }, []);

  const onClick = async () => {
    await plugin.services.todoistAPI
      .healthCheck(token)
      .then(async (isHealthy) => {
        if (isHealthy) {
          plugin.settings.token = token;
          await plugin.saveSettings();
          onConfirm();
        }
      });
  };

  return (
    <div>
      <p>API Token</p>
      <div className={styles["token-input"]}>
        <input
          type="text"
          maxLength={40}
          value={token}
          onChange={(event) => {
            setToken(event.target.value);
          }}
        />
        <Button name="Confirm" style="primary" onClick={onClick} />
      </div>
    </div>
  );
};

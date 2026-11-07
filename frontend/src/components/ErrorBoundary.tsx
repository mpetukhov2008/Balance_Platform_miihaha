import { Component, type ReactNode } from "react";

/** Сбой отрисовки не превращается в пустой экран: показываем ошибку и способ продолжить. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ maxWidth: 620, margin: "80px auto", padding: 16 }}>
        <div className="alert alert-bad" role="alert">
          <div style={{ flex: 1 }}>
            <b>Интерфейс столкнулся с ошибкой</b>
            <pre style={{ marginTop: 6 }}>{this.state.error.message}</pre>
          </div>
          <button className="btn btn-sm" onClick={() => location.reload()}>Перезагрузить</button>
        </div>
      </div>
    );
  }
}

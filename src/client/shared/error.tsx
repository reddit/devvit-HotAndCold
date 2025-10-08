import { Component } from 'preact';

export class ErrorBoundary extends Component {
  override state: { error: string | null } = { error: null };

  static override getDerivedStateFromError(error: Error) {
    return { error: error.message };
  }

  override componentDidCatch(error: Error) {
    console.error('ErrorBoundary caught error', error);
    this.setState({ error: error.message });
  }

  render() {
    if (this.state.error) {
      return <p>Oh no! We ran into an error: {this.state.error}</p>;
    }
    return this.props.children;
  }
}

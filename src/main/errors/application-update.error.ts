/** Обозначает ошибку пользовательского действия в процессе обновления приложения. */
export class ApplicationUpdateError extends Error {
  /** Создаёт ошибку, которую renderer может показать пользователю без технических деталей. */
  constructor(message: string) {
    super(message);
    this.name = 'ApplicationUpdateError';
  }
}

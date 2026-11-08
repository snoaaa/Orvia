import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { GoeyToasterComponent } from 'goey-toast-angular';

@Component({
  imports: [RouterOutlet, GoeyToasterComponent],
  selector: 'app-root',
  styleUrl: './app.css',
  template: `
    <goey-toaster position="bottom-right"></goey-toaster>
    <router-outlet></router-outlet>
  `,
})
export class App {
  protected readonly title = signal('web');
}

// angular import
import { Component, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';

// project import

// third party
import { NgApexchartsModule, ChartComponent, ApexOptions } from 'ng-apexcharts';

@Component({
  selector: 'app-analytics-chart',
  imports: [NgApexchartsModule, RouterLink],
  templateUrl: './analytics-chart.component.html',
  styleUrl: './analytics-chart.component.scss'
})
export class AnalyticsChartComponent {
  // public props
  chart = viewChild.required<ChartComponent>('chart');
  chartOptions: Partial<ApexOptions>;
  constructor() {
    this.chartOptions = {
      chart: {
        type: 'line',
        height: 340,
        fontFamily: "'Glacial Indifference', sans-serif",
        toolbar: {
          show: false
        },
        background: 'transparent'
      },
      plotOptions: {
        bar: {
          columnWidth: '45%',
          borderRadius: 4
        }
      },
      colors: ['#000000'],
      stroke: {
        curve: 'smooth',
        width: 1.5
      },
      grid: {
        strokeDashArray: 4,
        borderColor: '#f5f5f5'
      },
      series: [
        {
          data: [18, 24, 31, 28, 36, 41, 34, 44]
        }
      ],
      xaxis: {
        type: 'datetime',
        categories: [
          '2026-03-01T00:00:00.000Z',
          '2026-04-01T00:00:00.000Z',
          '2026-05-01T00:00:00.000Z',
          '2026-06-01T00:00:00.000Z',
          '2026-07-01T00:00:00.000Z',
          '2026-08-01T00:00:00.000Z',
          '2026-09-01T00:00:00.000Z',
          '2026-10-01T00:00:00.000Z'
        ],
        labels: {
          format: 'MMM',
          style: {
            colors: ['#222', '#222', '#222', '#222', '#222', '#222', '#222']
          }
        },
        axisBorder: {
          show: false
        },
        axisTicks: {
          show: false
        }
      },
      yaxis: {
        show: false
      },
      tooltip: {
        theme: 'light'
      }
    };
  }
}
